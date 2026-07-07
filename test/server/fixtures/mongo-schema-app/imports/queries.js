import { Students, Aliased, StudentsRepository } from "./collections";

export const queries = (studentId) => {
    Students.find({ firstName: "Ana", "contacts.relationship": "mother" });
    Students.findOne({ typoField: 1 });
    Students.find({}, { fields: { firstName: 1, projTypo: 1 } });
    Students.updateAsync(
        { _id: studentId },
        { $set: { "contacts.0.number": "555", "meta.anything": true } }
    );
    Students.update(
        { _id: studentId },
        { $set: { "contacts.0.relationshp": "typo" } }
    );
    Students.find({ [studentId]: 1 });
    Aliased.find({ styleName: "bold" });
    // The Repository wrapper: same collection, resolved through the
    // "name" property of its options object instead of a positional
    // Mongo.Collection argument.
    StudentsRepository.find({ firstName: "Ana", repoTypo: 1 });
};
