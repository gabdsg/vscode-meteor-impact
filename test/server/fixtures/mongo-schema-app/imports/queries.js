import { Students, Aliased } from "./collections";

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
};
