# 03-kubeconfig.diff

## reasoning

```
The task asks me to write `fix/kubeconfig.diff` — a one-line unified diff changing the server URL from `https://localhost:6443` to `https://10.0.0.5:6443`.

From the plan:
- `fix/kubeconfig.diff` — one hunk: the `server:` line.
- Standard unified diff format. Header lines reference the original file path (e.g., `a/kubeconfig.yaml`, `b/kubeconfig.yaml`).
- The original kubeconfig has `server: https://localhost:6443`.

A minimal unified diff for a one-line change. I need to provide enough context lines to make it a valid unified diff. Since I don't have the exact original file, I'll use reasonable context lines around the `server:` line.

A standard kubeconfig structure looks like:
```yaml
apiVersion: v1
kind: Config
clusters:
- cluster:
    server: https://localhost:6443
  name: staging
contexts:
- context:
    cluster: staging
    user: admin
  name: staging
current-context: staging
users:
- name: admin
  user:
    token: <token>
```

For a minimal unified diff, I need at least some context. A typical unified diff with 3 lines of context would look like:

```
--- a/kubeconfig.yaml
+++ b/kubeconfig.yaml
@@ -3,7 +3,7 @@ kind: Config
 clusters:
 - cluster:
-    server: https://localhost:6443
+    server: https://10.0.0.5:6443
   name: staging
 contexts:
 - context:
```

Wait, let me think about the line numbers. If the file is:
```
Line 1: apiVersion: v1
Line 2: kind: Config
Line 3: clusters:
Line 4: - cluster:
Line 5:     server: https://localhost:6443
Line 6:   name: staging
Line 7: contexts:
Line 8: - context:
```

The hunk would start at line 3 (3 lines before line 5, but we only have 2 lines before: line 1 and line 2). Let me use context of 3 lines:

Actually, with 3 lines of context before line 5, that would be lines 2, 3, 4. And 3 lines after: lines 6, 7, 8.

The hunk header would be `@@ -2,7 +2,7 @@` (starting at line 2, 7 lines total: 3 context + 1 removed + 3 context = 7... wait no. The hunk includes: 3 lines before, 1 line changed (counted as both removed and added), 3 lines after. So the "old" side has 3+1+3 = 7 lines starting at line 2. The "new" side also has 3+1+3 = 7 lines starting at line 2.

Wait, let me recount:
- Context before: lines 2, 3, 4 (3 lines)
- Changed line: line 5 (1 line)
- Context after: lines 6, 7, 8 (3 lines)

Old side: starts at line 2, count = 3 + 1 + 3 = 7
New side: starts at line 2, count = 3 + 1 + 3 = 7

So: `@@ -2,7 +2,7 @@`

The hunk content:
```
 kind: Config
 clusters:
 - cluster:
-    server: https://localhost:6443
+    server: https://10.0.0.5:6443
   name: staging
 contexts:
 - context:
```

That looks right. Let me format it properly as a unified diff.

Actually, I should double-check: the plan says "one hunk: the `server:` line" and "one-line unified diff changing server URL to https://10.0.0.5:6443". The plan also says the header lines reference `a/kubeconfig.yaml`, `b/kubeconfig.yaml`.

Let me write it out cleanly.
```

## reply

```
--- a/kubeconfig.yaml
+++ b/kubeconfig.yaml
@@ -2,7 +2,7 @@ kind: Config
 kind: Config
 clusters:
 - cluster:
-    server: https://localhost:6443
+    server: https://10.0.0.5:6443
   name: staging
 contexts:
 - context:
```
