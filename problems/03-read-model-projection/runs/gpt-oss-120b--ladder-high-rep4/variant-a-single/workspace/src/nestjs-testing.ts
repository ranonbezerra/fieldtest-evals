export const Test = {
  async createTestingModule(opts: any) {
    // Very simple mock that returns the module definition unchanged
    return {
      async compile() {
        // Mimic Nest's ModuleRef with a simple getter map
        const providers = new Map();

        const collect = (module: any) => {
          if (module.providers) {
            for (const prov of module.providers) {
              providers.set(prov, new prov());
            }
          }
          if (module.imports) {
            for (const imp of module.imports) {
              collect(imp);
            }
          }
        };

        collect(opts);

        return {
          get<T>(type: any): T {
            const instance = providers.get(type);
            if (!instance) {
              throw new Error(`Provider not found: ${type?.name}`);
            }
            return instance as T;
          },
        };
      },
    };
  },
};
