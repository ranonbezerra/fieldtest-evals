<result>
<name>Read</name>
<output>1	/**
2	 * PLAN.md — Refresh-token rotation with reuse detection (Variant A)
3	 *
4	 * This file is the binding design document for the implementation.
5	 * Every requirement below is non-negotiable; tests must exercise each one.
6	 */
7	
8	# 1. Scope
9	
10	Implement refresh-token rotation for a NestJS API with Prisma + PostgreSQL.
11	
12	- `POST /auth/refresh` accepts a refresh token (JSON body `refreshToken` or
13	  `refresh_token` cookie) and returns a **new** access token and a **new**
14	  refresh token. The presented token is retired atomically in the same call.
15	
16	# 2. Token model
17	
18	| Field            | Type     | Notes                                             |
19	|------------------|----------|---------------------------------------------------|
20	| `id`             | `String` | Primary key, the token value presented by client  |
21	| `familyId`       | `String` | Groups all tokens descended from one sign-in      |
22	| `sessionId`      | `String` | Links to the session row                          |
23	| `createdAt`      | `Date`   | When the token was issued                         |
24	| `retiredAt`      | `Date?`  | When the token was rotated out; null = active     |
25	| `revokedAt`      | `Date?`  | When the token was revoked due to compromise      |
26	
27	Session:
28	
29	| Field         | Type     | Notes                                          |
30	|---------------|----------|------------------------------------------------|
31	| `id`          | `String` | Primary key                                    |
32	| `userId`      | `String` | FK to user                                     |
33	| `createdAt`   | `Date`   | Sign-in time                                   |
34	| `expiresAt`   | `Date`   | **Absolute** deadline; never extended by rotation |
35	
36	Audit record (append-only):
37	
38	| Field         | Type     | Notes                                            |
39	|---------------|----------|--------------------------------------------------|
40	| `id`          | `String` | Primary key                                      |
41	| `familyId`    | `String` | The token family this event belongs to           |
42	| `tokenId`     | `String` | The specific token involved                      |
43	| `event`       | `String` | `rotate` \| `reuse_detected` \| `expired` \| `malformed` \| `unknown` |
44	| `details`     | `Json`   | Structured context (e.g. `{ "reason": "expired" }`) |
45	| `createdAt`   | `Date`   | When the event was recorded                      |
46	
47	# 3. Rotation algorithm
48	
49	```
50	rotate(presentedToken):
51	  1. Look up the token row by `id` (the presented token value).
52	     - Not found            → reject as `unknown`, audit, return error envelope.
53	  2. Check `revokedAt` IS NOT NULL.
54	     - Revoked              → this is a reuse of an already-retired/revoked token.
55	                               Invalidate the **entire family** (set `revokedAt`
56	                               on every token in the family that is not already
57	                               revoked). Audit as `reuse_detected`. Return error
58	                               envelope (indistinguishable from other rejections).
59	  3. Check `retiredAt` IS NOT NULL (and `revokedAt` IS NULL).
60	     - Retired              → same as step 2: family-wide invalidation, audit
61	                               `reuse_detected`, error envelope.
62	  4. Check session `expiresAt` <= now.
63	     - Expired              → audit `expired`, error envelope.
64	  5. All checks passed. Inside a single database transaction:
65	     a. Set `retiredAt = now` on the presented token (atomic compare-and-swap:
66	        `UPDATE … WHERE id = ? AND retiredAt IS NULL AND revokedAt IS NULL`).
67	        - If `affectedRows === 0`, another concurrent request already rotated
68	          this token. Go to step 2/3 logic (reuse).
69	     b. Create the new token row (same `familyId`, same `sessionId`).
70	     c. Create an audit record with `event = 'rotate'`.
71	     d. Commit.
72	  6. Issue a new access token via `issueAccessToken(userId)`.
73	  7. Return `{ accessToken, refreshToken: newTokenId }`.
74	```
75	
76	**Why this ordering:**
77	
78	- Revoked/retired checks (steps 2-3) come **before** the expiry check (step 4).
79	  A reused token is a security event; we must detect and record it even if the
80	  session has also expired. If we checked expiry first, a reused-but-expired
81	  token would be silently dropped as "expired" and the compromise would go
82	  unrecorded.
83	
84	- The atomic CAS in step 5a is what makes concurrent rotation safe. Two
85	  concurrent requests both pass steps 1-4, but only one will successfully
86	  execute the `UPDATE … WHERE retiredAt IS NULL`. The loser sees `affectedRows = 0`,
87	  re-reads the row, sees it is now retired, and follows the reuse path.
88	
89	- The transaction boundary (step 5) ensures that the retirement, the new token
90	  creation, and the audit record are all-or-nothing. No partial state is visible.
91	
92	# 4. Indistinguishability
93	
94	Every rejection — expired, retired (reuse), revoked (reuse), unknown, malformed —
95	returns the **same** HTTP status code and the **same** error envelope shape:
96	
97	```json
98	{
99	  "error": {
100	    "code": "invalid_token",
101	    "message": "Invalid or expired refresh token",
102	    "details": {}
103	  }
104	}
105	```
106	
107	The audit log is the **only** place where the distinction is recorded.
108	
109	# 5. Source of the refresh token
110	
111	The refresh token may arrive via:
112	
113	1. JSON body: `{ "refreshToken": "…" }`
114	2. Cookie: `refresh_token=…`
115	
116	**Precedence:** the JSON body value wins when both are present. Rationale:
117	cookie values can be stale (browser auto-sends the last one); an explicit body
118	value is a deliberate client action and is therefore more trustworthy.
119	
120	# 6. Layering
121	
122	| Layer       | Responsibility                                                       |
123	|-------------|----------------------------------------------------------------------|
124	| Controller  | Parse input (body/cookie), validate presence, call service, shape response |
125	| Service     | All business logic: ordering of checks, rotation algorithm, audit decisions |
126	| Repository  | All Prisma calls. Exposes narrow methods; no business logic.          |
127	
128	The service must **not** call Prisma directly.
129	
130	# 7. Tests
131	
132	| Test name                              | What it verifies                                                    |
133	|----------------------------------------|---------------------------------------------------------------------|
134	| concurrent presentation of one token   | Two concurrent `rotate()` calls; exactly one succeeds, one fails    |
135	| replay invalidates sibling token       | Rotate token A, replay A; token B (sibling in same family) is revoked |
136	| rotation against absolute deadline     | Session expires at T; rotation at T+ε fails as expired              |
137	| rejection responses are indistinguishable | Expired, retired, unknown, malformed all return identical envelope |
138	
139	# 8. Deliverables checklist
140	
141	- [ ] `prisma/schema.prisma` + migration
142	- [ ] `src/auth/auth.module.ts`
143	- [ ] `src/auth/auth.controller.ts`
144	- [ ] `src/auth/auth.service.ts`
145	- [ ] `src/auth/auth.repository.ts`
146	- [ ] `test/auth.spec.ts`
147	- [ ] `SECURITY.md`
</output>
</result>
<result>
<name>Read</name>
<output>1	// src/auth/auth.controller.ts
2	import { Body, Controller, Post, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
3	import type { Request, Response } from 'express';
4	import { AuthService } from './auth.service';
5	
6	interface RefreshRequest {
7	  refreshToken?: string;
8	}
9	
10	@Controller('auth')
11	export class AuthController {
12	  constructor(private readonly authService: AuthService) {}
13	
14	  @Post('refresh')
15	  @HttpCode(HttpStatus.OK)
16	  async refresh(
17	    @Body() body: RefreshRequest,
18	    @Req() req: Request,
19	    @Res() res: Response,
20	  ): Promise<void> {
21	    // Precedence: JSON body wins over cookie.
22	    const cookieToken = req.cookies?.refresh_token as string | undefined;
23	    const refreshToken = body.refreshToken ?? cookieToken;
24	
25	    if (!refreshToken) {
26	      res.status(HttpStatus.UNAUTHORIZED).json({
27	        error: {
</output>
</result>
<result>
<name>Read</name>
<output>1	// src/auth/auth.service.ts
2	import { Injectable, UnauthorizedException } from '@nestjs/common';
3	import { AuthRepository } from './auth.repository';
4	
5	@Injectable()
6	export class AuthService {
7	  constructor(
8	    private readonly repo: AuthRepository,
9	    private readonly issueAccessToken: (userId: string) => string,
10	  ) {}
11	}
</output>
</result>
<result>
<name>Read</name>
<output>1	// src/auth/auth.repository.ts
2	import { Injectable } from '@nestjs/common';
3	
4	@Injectable()
5	export class AuthRepository {}
</output>
</result>
