/**
 * Indexer for MongoDB $jsonSchema validators kept in an external
 * "MongoSchema" repository (configured via the mongoSchemaPath setting)
 * with the layout schemas/<collectionName>/<collectionName>.schema.json,
 * where the collection name is the directory name.
 *
 * Schema files are parsed with the Babel parser (already a dependency)
 * instead of JSON.parse so every field keeps its line number - that makes
 * go-to-definition into the schema file free.
 *
 * Collection variables are joined on the collection-name string of
 * `new Mongo.Collection("name")`, never on the variable name: apps alias
 * (e.g. `const Whitelist = new Mongo.Collection("organicEmailWhitelist")`).
 */

const OBJECT_BSON_TYPE = "object";
const ARRAY_BSON_TYPE = "array";

class MongoSchemaIndexer {
    constructor() {
        // collectionName -> { schemaFsPath, fieldsMap, additionalPropertiesFalseAt }
        // fieldsMap: "dotted.path" -> { bsonTypes, required, line, openObject }
        this.schemasMap = {};
        // variable name -> { collectionName, uri }
        this.collectionVarsMap = {};
    }

    async loadSchemas(schemaRootFsPath) {
        this.schemasMap = {};
        if (!schemaRootFsPath) return;

        const fs = require("fs/promises");
        const path = require("path");

        let collectionDirs;
        try {
            collectionDirs = (
                await fs.readdir(path.join(schemaRootFsPath, "schemas"), {
                    withFileTypes: true,
                })
            ).filter((entry) => entry.isDirectory());
        } catch (e) {
            console.warn(
                `MongoSchema path is set but not readable: ${schemaRootFsPath}. ${e.message}`
            );
            return;
        }

        for (const dir of collectionDirs) {
            const collectionName = dir.name;
            const schemaFsPath = path.join(
                schemaRootFsPath,
                "schemas",
                collectionName,
                `${collectionName}.schema.json`
            );

            try {
                const content = await fs.readFile(schemaFsPath, "utf-8");
                this.schemasMap[collectionName] = this.parseSchema({
                    content,
                    schemaFsPath,
                });
            } catch (e) {
                // Missing or broken schema files must never take the index
                // down; the collection simply has no field intelligence.
                console.warn(
                    `Skipping MongoDB schema for "${collectionName}". ${e.message}`
                );
            }
        }
    }

    parseSchema({ content, schemaFsPath }) {
        const { AstWalker, parseJsSource, NODE_TYPES } =
            require("./ast-helpers");

        // Wrapping in parens turns the JSON document into an expression;
        // Babel then reports a line for every property.
        const walker = new AstWalker(`(${content})`, parseJsSource, {
            errorRecovery: false,
        });
        const root = walker.ast?.program?.body?.[0]?.expression;
        if (root?.type !== NODE_TYPES.OBJECT_EXPRESSION) {
            throw new Error("schema root is not an object");
        }

        const schema = {
            schemaFsPath,
            fieldsMap: {},
            additionalPropertiesFalseAt: [],
        };
        this.collectFields({ objectNode: root, prefix: "", schema });

        // Every collection has _id, whether the schema declares it or not.
        schema.fieldsMap["_id"] = schema.fieldsMap["_id"] || {
            bsonTypes: ["objectId", "string"],
            required: true,
            line: 1,
            openObject: false,
        };

        return schema;
    }

    // Walk one $jsonSchema object node ({ bsonType, properties, items,
    // required, additionalProperties, ... }) flattening nested properties
    // into dotted paths. Array `items` recurse transparently: the path of
    // contacts[].relationship is "contacts.relationship".
    collectFields({ objectNode, prefix, schema }) {
        const { NODE_TYPES } = require("./ast-helpers");

        const getProperty = (node, name) =>
            node?.properties?.find(
                ({ key }) => (key?.value ?? key?.name) === name
            );
        const literalValues = (valueNode) => {
            if (!valueNode) return [];
            if (valueNode.type === NODE_TYPES.LITERAL) {
                return [valueNode.value];
            }
            if (valueNode.type === "ArrayExpression") {
                return (valueNode.elements || [])
                    .filter((el) => el?.type === NODE_TYPES.LITERAL)
                    .map(({ value }) => value);
            }
            return [];
        };

        const additionalProperties = getProperty(
            objectNode,
            "additionalProperties"
        );
        if (additionalProperties?.value?.value === false) {
            schema.additionalPropertiesFalseAt.push(prefix);
        }

        const requiredNames = new Set(
            literalValues(getProperty(objectNode, "required")?.value)
        );

        const propertiesNode = getProperty(objectNode, "properties")?.value;
        if (propertiesNode?.type !== NODE_TYPES.OBJECT_EXPRESSION) return;

        for (const property of propertiesNode.properties || []) {
            const fieldName = property.key?.value ?? property.key?.name;
            const definition = property.value;
            if (
                typeof fieldName !== "string" ||
                definition?.type !== NODE_TYPES.OBJECT_EXPRESSION
            ) {
                continue;
            }

            const dottedPath = prefix ? `${prefix}.${fieldName}` : fieldName;
            const bsonTypes = literalValues(
                getProperty(definition, "bsonType")?.value
            );

            const nestedProperties = getProperty(definition, "properties");
            const itemsNode = getProperty(definition, "items")?.value;
            const itemsProperties =
                itemsNode?.type === NODE_TYPES.OBJECT_EXPRESSION &&
                getProperty(itemsNode, "properties");

            // An object (or array of objects) without declared properties
            // is open: anything below it is legitimate.
            const isObjectLike =
                bsonTypes.includes(OBJECT_BSON_TYPE) ||
                bsonTypes.includes(ARRAY_BSON_TYPE);
            const openObject =
                isObjectLike && !nestedProperties && !itemsProperties;

            schema.fieldsMap[dottedPath] = {
                bsonTypes,
                required: requiredNames.has(fieldName),
                line: property.loc?.start.line ?? 1,
                openObject,
            };

            if (nestedProperties) {
                this.collectFields({
                    objectNode: definition,
                    prefix: dottedPath,
                    schema,
                });
            }
            if (itemsProperties) {
                this.collectFields({
                    objectNode: itemsNode,
                    prefix: dottedPath,
                    schema,
                });
            }
        }
    }

    // Called per-node from the JS index walk: remember
    // `X = new Mongo.Collection("name")` declarations and assignments.
    indexCollectionDeclarations({ node, uri }) {
        const { NODE_TYPES } = require("./ast-helpers");

        let targetName;
        let initNode;
        if (node.type === "VariableDeclarator") {
            targetName = node.id?.type === NODE_TYPES.IDENTIFIER && node.id.name;
            initNode = node.init;
        } else if (node.type === "AssignmentExpression") {
            targetName =
                node.left?.type === NODE_TYPES.IDENTIFIER && node.left.name;
            initNode = node.right;
        } else {
            return;
        }

        if (
            !targetName ||
            initNode?.type !== NODE_TYPES.NEW_EXPRESSION ||
            initNode.callee?.type !== NODE_TYPES.MEMBER_EXPRESSION ||
            initNode.callee.object?.name !== "Mongo" ||
            initNode.callee.property?.name !== "Collection"
        ) {
            return;
        }

        const nameArgument = initNode.arguments?.[0];
        if (
            nameArgument?.type !== NODE_TYPES.LITERAL ||
            typeof nameArgument.value !== "string"
        ) {
            // new Mongo.Collection(null) is a client-only collection.
            return;
        }

        this.collectionVarsMap[targetName] = {
            collectionName: nameArgument.value,
            uri,
        };
    }

    // "Students" -> the students schema (or undefined). Meteor.users is
    // handled by the callers passing "Meteor.users" through resolveByName.
    resolveCollection(varName) {
        if (varName === "Meteor.users") return this.schemasMap["users"];

        const declaration = this.collectionVarsMap[varName];
        return declaration && this.schemasMap[declaration.collectionName];
    }

    // Normalize a query path before lookup: drop $ positional segments
    // ($, $[], $[id]) and numeric array indexes - contacts.0.number and
    // contacts.$.number both resolve as contacts.number.
    static normalizePath(dottedPath) {
        return dottedPath
            .split(".")
            .filter(
                (segment) =>
                    segment !== "$" &&
                    !/^\$\[[^\]]*\]$/.test(segment) &&
                    !/^\d+$/.test(segment)
            )
            .join(".");
    }

    lookupField(schema, dottedPath) {
        if (!schema) return;
        return schema.fieldsMap[MongoSchemaIndexer.normalizePath(dottedPath)];
    }

    /**
     * Should an unknown path be reported at all? Not when any ancestor is
     * an open object (or itself unknown below an open one): the schema
     * simply doesn't describe that subtree.
     */
    isPathFlaggable(schema, dottedPath) {
        if (!schema) return false;

        const segments =
            MongoSchemaIndexer.normalizePath(dottedPath).split(".");
        for (let i = 1; i < segments.length; i++) {
            const ancestorPath = segments.slice(0, i).join(".");
            const ancestor = schema.fieldsMap[ancestorPath];
            if (!ancestor) return false;
            if (ancestor.openObject) return false;
        }
        return true;
    }

    // Severity driver: is the nearest described ancestor explicitly closed
    // (additionalProperties: false)?
    isUnderClosedObject(schema, dottedPath) {
        if (!schema) return false;

        const segments =
            MongoSchemaIndexer.normalizePath(dottedPath).split(".");
        const parentPrefix = segments.slice(0, -1).join(".");
        return schema.additionalPropertiesFalseAt.includes(parentPrefix);
    }

    removeUri(fsPath) {
        for (const [varName, { uri }] of Object.entries(
            this.collectionVarsMap
        )) {
            if (uri?.fsPath === fsPath) delete this.collectionVarsMap[varName];
        }
    }

    reset() {
        // schemasMap survives resets: it belongs to the external repo, not
        // to workspace files, and reloads in loadSources.
        this.collectionVarsMap = {};
    }
}

module.exports = { MongoSchemaIndexer };
