import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/lib/db";
import { deleteStudent, registerStudent, studentAuthByEmail, upsertStudentByEmail } from "@/lib/db/repo";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { migrate } from "../scripts/migrate";

beforeAll(async () => {
  await migrate(process.env.DATABASE_URL!, { log: false });
});

beforeEach(async () => {
  await sql`truncate students cascade`;
});

afterAll(async () => {
  await sql.end();
});

describe("database accounts", () => {
  it("stores a password and checks it", async () => {
    const hash = await hashPassword("correct horse");
    expect(await registerStudent("ada@school.edu", hash, "Ada")).toBe("created");
    const row = await studentAuthByEmail("ada@school.edu");
    expect(row?.passwordHash).toBeTruthy();
    expect(await verifyPassword("correct horse", row!.passwordHash!)).toBe(true);
    expect(await verifyPassword("nope", row!.passwordHash!)).toBe(false);
    expect(await registerStudent("ada@school.edu", hash, "Ada")).toBe("exists");
    await deleteStudent(row!.id);
  });

  it("lets a Google-only email set a password later", async () => {
    const student = await upsertStudentByEmail("ada@school.edu", "Ada Lovelace");
    expect(student.displayName).toBe("Ada Lovelace");
    const hash = await hashPassword("correct horse");
    expect(await registerStudent("ada@school.edu", hash, "Ada")).toBe("claimed");
    const row = await studentAuthByEmail("ada@school.edu");
    expect(await verifyPassword("correct horse", row!.passwordHash!)).toBe(true);
  });
});
