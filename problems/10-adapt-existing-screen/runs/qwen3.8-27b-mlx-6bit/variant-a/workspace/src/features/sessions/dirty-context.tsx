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
