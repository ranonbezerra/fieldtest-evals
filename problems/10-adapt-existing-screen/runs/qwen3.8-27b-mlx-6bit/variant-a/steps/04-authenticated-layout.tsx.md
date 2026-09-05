# 04-authenticated-layout.tsx

## reasoning

```
The user wants me to write `src/app/authenticated-layout.tsx` based on the plan.

From the plan:
- Section 3 says: `src/app/authenticated-layout.tsx (modified)` — "Renders `<ActiveSessionBar />` above the `<Outlet />`. No new props; reads hooks directly."
- Section 1 says: "Layout file: the authenticated layout lives at `src/app/authenticated-layout.tsx` (existing); the bar is inserted there."

So this is an existing file that I need to modify. The modification is inserting `<ActiveSessionBar />` above the `<Outlet />`.

Since this is an "existing" file that I'm modifying, I need to write the complete file. The plan says it's the authenticated layout with the bar above the outlet. Since I don't have the original file content, I need to write a complete authenticated layout that:
1. Has a `<Outlet />` (standard react-router pattern for nested routes)
2. Renders `<ActiveSessionBar />` above the `<Outlet />`
3. Is wrapped in a `DirtyProvider` since the plan mentions "a small React context (`DirtyContext`) sits above the detail route" — actually, let me re-read.

The plan says: "Dirty flag sharing: a small React context (`DirtyContext`) sits above the detail route; the detail screen writes, the bar reads."

Wait, but the bar doesn't read dirty flag. Let me re-read: "The detail screen writes, the bar reads." Hmm, actually looking at the control flow table:

"Active = A, dirty | Operator opens detail B | window.confirm("Discard unsaved notes?")"

So the confirmation check happens in the detail screen on mount, not in the bar. The bar just shows "Resume" and "Close session". The dirty check is when navigating to a NEW detail screen while the current one is dirty.

Actually, re-reading more carefully: "The detail screen writes, the bar reads." — but looking at the bar component code, it doesn't use dirty context. The detail screen uses `useDirty()` to set dirty state, and on mount when a different session is active and dirty, it shows confirm.

Wait, but if the detail screen sets itself active on mount, and the dirty flag is from the PREVIOUS detail screen... How does the new detail screen know the previous one was dirty? The DirtyContext persists across route changes (it sits above the detail route), so when you navigate from detail A to detail B, the DirtyContext still has the dirty state from A. The new detail screen (B) on mount checks `useDirty().isDirty` — if true, it means the previous session had unsaved notes.

So the `DirtyProvider` needs to wrap the outlet area so it persists across navigation between detail screens. It should be in the authenticated layout, above the `<Outlet />`.

Let me structure the file:

```tsx
import { Outlet } from 'react-router-dom';
import { ActiveSessionBar } from '../features/sessions/active-session-bar';
import { DirtyProvider } from '../features/sessions/dirty-context';

export function AuthenticatedLayout(): React.ReactElement {
  return (
    <DirtyProvider>
      <ActiveSessionBar />
      <Outlet />
    </DirtyProvider>
  );
}
```

Wait, but the plan says "No new props; reads hooks directly." This is about the bar reading hooks. The layout itself just composes the components.

Also, should `DirtyProvider` be in this file? The plan's manifest says:
- `src/app/authenticated-layout.tsx | reads: src/features/sessions/active-session-bar.tsx | Authenticated layout with bar above outlet`

It only mentions reading `active-session-bar.tsx`. It doesn't mention `dirty-context.tsx`. But the plan says DirtyContext "sits above the detail route". Where is that? It could be in the layout.

Hmm, but the manifest only lists `active-session-bar.tsx` as a read for the layout file. Let me think about whether DirtyProvider belongs here or somewhere else.

The plan says: "a small React context (`DirtyContext`) sits above the detail route; the detail screen writes, the bar reads."

"sits above the detail route" — this means it wraps the routes where detail screens live. The authenticated layout is above all authenticated routes including the detail route. So it makes sense to put DirtyProvider here.

But the manifest only lists `active-session-bar.tsx` as a dependency. Maybe DirtyProvider is already in the layout from before (it's an existing file being modified), or maybe it's placed at a different level.

Actually, wait. Let me re-read the plan more carefully. It says "the authenticated layout lives at `src/app/authenticated-layout.tsx` (existing); the bar is inserted there." So the existing file already has some structure. I'm just adding the bar.

The manifest for this file says it reads only `active-session-bar.tsx`. So maybe DirtyProvider is already present in the existing layout, or it's placed elsewhere.

Given the constraint "Implement exactly what the plan specifies for this file. Do not add an export, a feature or a file the plan does not name", and the manifest only lists `active-session-bar.tsx` as a read...

But I need to write the COMPLETE file. If DirtyProvider was already there, I'd include it. But I don't know what was already there.

Let me think about this differently. The plan says the layout is "modified" — I'm writing the result of that modification. The key change is inserting `<ActiveSessionBar />` above `<Outlet />`. 

For DirtyProvider: the plan says it "sits above the detail route." This is a logical requirement. The most natural place for it in the layout hierarchy is the authenticated layout, wrapping the Outlet. Since the detail screens are children of this layout's Outlet, placing DirtyProvider here ensures it persists across navigation.

I'll include it. The manifest might just be listing the primary new dependency (the bar), not every import.

Actually, let me reconsider. The instruction says "Do not add an export, a feature or a file the plan does not name." DirtyProvider IS named in the plan. It's part of the architecture. The layout needs to provide it for the feature to work. I'll include it.

Let me write the complete file:

```tsx
import { Outlet } from 'react-router-dom';
import { ActiveSessionBar } from '../features/sessions/active-session-bar';
import { DirtyProvider } from '../features/sessions/dirty-context';

export function AuthenticatedLayout(): React.ReactElement {
  return (
    <DirtyProvider>
      <ActiveSessionBar />
      <Outlet />
    </DirtyProvider>
  );
}
```

This is clean, minimal, and does exactly what the plan specifies:
- Renders `<ActiveSessionBar />` above the `<Outlet />`
- No new props
- Wraps in DirtyProvider so the dirty context persists across route changes within authenticated screens

I think this is correct. Let me finalize.
```

## reply

```tsx
import { Outlet } from 'react-router-dom';
import { ActiveSessionBar } from '../features/sessions/active-session-bar';
import { DirtyProvider } from '../features/sessions/dirty-context';

export function AuthenticatedLayout(): React.ReactElement {
  return (
    <DirtyProvider>
      <ActiveSessionBar />
      <Outlet />
    </DirtyProvider>
  );
}
```
