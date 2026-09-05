# 01-dirty-context.tsx

## reasoning

```
The task is to write exactly one file: `src/features/sessions/dirty-context.tsx`.

From the plan, I need:
- `DirtyContext` - a React context
- `useDirty` hook - reads from the context, throws if no provider
- `DirtyProvider` - provides the dirty state to children

The signatures from the plan:

```ts
export interface DirtyContextValue {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
}

export declare function useDirty(): DirtyContextValue; // throws if no <DirtyProvider>
export declare function DirtyProvider(props: { children: React.ReactNode }): React.ReactElement;
```

So I need:
1. A `DirtyContextValue` interface with `isDirty: boolean` and `setDirty: (dirty: boolean) => void`
2. A React context with a default value that is `null` (or similar sentinel) so `useDirty` can detect absence
3. A `useDirty()` hook that reads the context and throws if no provider is present
4. A `DirtyProvider` component that wraps children with the context, managing local state for `isDirty`

Let me write this in TypeScript, ESM style (the project uses `"type": "module"`).

The file should be clean, minimal, and exactly match the plan. No extra exports, no extra features.

Let me write it:
```

## reply

```tsx
import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface DirtyContextValue {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
}

const DirtyContext = createContext<DirtyContextValue | null>(null);

export function useDirty(): DirtyContextValue {
  const ctx = useContext(DirtyContext);
  if (ctx === null) {
    throw new Error('useDirty must be used within a <DirtyProvider>');
  }
  return ctx;
}

export function DirtyProvider(props: { children: ReactNode }): ReactElement {
  const [isDirty, setIsDirty] = useState(false);

  const setDirty = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  const value: DirtyContextValue = { isDirty, setDirty };

  return (
    <DirtyContext.Provider value={value}>
      {props.children}
    </DirtyContext.Provider>
  );
}
```
