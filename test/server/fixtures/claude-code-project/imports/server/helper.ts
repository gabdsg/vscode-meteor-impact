export function typedHelper(input: string): string {
    return input.trim();
}

export class InstitutionData {
    static async getSchoolsForInstitution(params: {
        institutionId: string;
    }): Promise<string[]> {
        return [params.institutionId];
    }
}
