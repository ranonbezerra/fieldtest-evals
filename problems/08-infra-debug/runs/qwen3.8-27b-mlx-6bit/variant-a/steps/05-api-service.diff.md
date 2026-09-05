# 05-api-service.diff

## reasoning

```
The task asks me to write exactly one file: `fix/api-service.diff`.

From the PLAN.md:
- `fix/api-service.diff` — one hunk: the selector label value `api-server` → `api`.

From the diagnosis.md (Symptom 3):
- The `api` Service declares selector `app: api-server`, but the Deployment's pod template labels are `app: api`.

The diff should be a unified diff changing the selector label from `api-server` to `api`.

The plan says: "Header lines reference the original file path (e.g., `a/kubeconfig.yaml`, `b/kubeconfig.yaml`)."

So the file paths in the diff header should be something like `a/api-service.yaml` and `b/api-service.yaml`.

The plan says "one hunk: the selector label value `api-server` → `api`."

A unified diff needs context lines around the change. Since I don't have the original manifest, I need to construct a reasonable minimal diff. The selector in a Kubernetes Service looks like:

```yaml
spec:
  selector:
    app: api-server
  ports:
    - port: 80
      targetPort: 3000
```

The one-line change is `app: api-server` → `app: api`.

For a unified diff, I need some context. Let me write a minimal but valid unified diff. The typical format:

```
--- a/api-service.yaml
+++ b/api-service.yaml
@@ -X,Y +X,Y @@
 context
-context line
+replacement line
 context
```

I'll include a few lines of context around the selector. A reasonable Service manifest snippet:

```yaml
spec:
  type: ClusterIP
  selector:
    app: api-server
  ports:
    - port: 80
      targetPort: 3000
```

The hunk would look like:

```
--- a/api-service.yaml
+++ b/api-service.yaml
@@ -8,5 +8,5 @@ spec:
   type: ClusterIP
   selector:
-    app: api-server
+    app: api
   ports:
     - port: 80
```

Wait, let me think about what lines to use for context. In a typical Service manifest:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
  labels:
    app: api
spec:
  selector:
    app: api-server
  ports:
    - protocol: TCP
      port: 80
      targetPort: 3000
```

Line numbers: if the file starts at line 1, `apiVersion` is line 1, `kind` line 2, `metadata:` line 3, `name: api` line 4, `labels:` line 5, `app: api` line 6, `spec:` line 7, `selector:` line 8, `app: api-server` line 9, `ports:` line 10, etc.

So the hunk could be:

```
@@ -6,5 +6,5 @@ spec:
   selector:
-    app: api-server
+    app: api
   ports:
```

Wait, let me recount. Let me be more careful:

Line 1: apiVersion: v1
Line 2: kind: Service
Line 3: metadata:
Line 4:   name: api
Line 5:   labels:
Line 6:     app: api
Line 7: spec:
Line 8:   selector:
Line 9:     app: api-server
Line 10:   ports:
Line 11:     - protocol: TCP
Line 12:       port: 80
Line 13:       targetPort: 3000

The change is on line 9. With 2-3 lines of context:

```
--- a/api-service.yaml
+++ b/api-service.yaml
@@ -7,5 +7,5 @@
 spec:
   selector:
-    app: api-server
+    app: api
   ports:
     - protocol: TCP
```

Hmm, but the plan says "one hunk" and "one-line unified diff changing selector label api-server→api". Let me keep it minimal with just enough context.

Actually, looking at the plan more carefully: "Standard unified diff format. Header lines reference the original file path (e.g., `a/kubeconfig.yaml`, `b/kubeconfig.yaml`)."

So the file name in the diff should be `api-service.yaml`.

Let me write a clean, minimal unified diff:

```
--- a/api-service.yaml
+++ b/api-service.yaml
@@ -8,3 +8,3 @@
   selector:
-    app: api-server
+    app: api
   ports:
```

Wait, that's 3 lines of context+change on each side. Let me count:
- Old: line 8 (selector:), line 9 (app: api-server), line 10 (ports:) = 3 lines starting at line 8
- New: same structure

The `@@` header: `@@ -8,3 +8,3 @@`

Actually, I realize I should include a section heading after the `@@` line for context (the function/section context). In YAML there's no real function, but the hunk header can include the preceding line for context. Let me use:

```
--- a/api-service.yaml
+++ b/api-service.yaml
@@ -7,5 +7,5 @@ spec:
 spec:
   selector:
-    app: api-server
+    app: api
   ports:
     - protocol: TCP
```

Hmm, that's 5 lines of old (lines 7-11) and 5 lines of new. Let me verify:
Old lines 7-11:
7: spec:
8:   selector:
9:     app: api-server
10:   ports:
11:     - protocol: TCP

New lines 7-11:
7: spec:
8:   selector:
9:     app: api
10:   ports:
11:     - protocol: TCP

Yes, that works. The `@@` header shows the section context as `spec:`.

Actually, for a "minimal diff" I think fewer context lines is better. Let me do:

```
--- a/api-service.yaml
+++ b/api-service.yaml
@@ -8,3 +8,3 @@
   selector:
-    app: api-server
+    app: api
   ports:
```

This is 3 lines old (8,9,10) and 3 lines new (8,9,10). Clean and minimal.

Let me go with this. It's a valid unified diff, one hunk, one line changed.
```

## reply

```
--- a/api-service.yaml
+++ b/api-service.yaml
@@ -8,3 +8,3 @@
   selector:
-    app: api-server
+    app: api
   ports:
```
