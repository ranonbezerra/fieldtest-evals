# Variant C — School network platform

An ed-tech platform serves independent schools: each school has its own domain,
branding, staff, students, and grade records. Privacy law makes cross-school
data exposure a reportable incident. Tokens carry a `school` claim; requests
arrive on the school's domain.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. School resolution middleware from host + token claim (must agree), kept in
   request-scoped context; mismatch = reject.
2. Structural isolation: school-aware Prisma client that scopes all reads and
   stamps all writes centrally — a handler must not be able to forget it.
3. Schema for staff/students/enrollments/grades with school-scoped uniqueness
   (student registration number unique per school, staff email per school).
4. `GET /school-config` — branding + enabled modules for the resolved school.
5. Tests: school B cannot list, fetch-by-id (404), update, or delete school A's
   students or grades; same registration number in two schools; concurrent
   requests from different schools keep contexts separate; a create request
   carrying a forged schoolId in the body is stamped with the context's school,
   not the forged one.
