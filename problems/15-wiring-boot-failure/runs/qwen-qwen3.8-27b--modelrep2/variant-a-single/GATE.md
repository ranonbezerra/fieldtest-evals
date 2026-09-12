$ pnpm install -> 0
Lockfile is up to date, resolution step is skipped
Progress: resolved 1, reused 0, downloaded 0, added 0
Packages: +172
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 172, reused 172, downloaded 0, added 172, done

dependencies:
+ @nestjs/common 10.4.22
+ @nestjs/core 10.4.22
+ @nestjs/platform-express 10.4.22
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/express 4.17.25
+ @types/node 22.20.1
+ typescript 5.9.3
+ vitest 2.1.9

Done in 620ms using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
test/app.module.spec.ts(3,10): error TS2305: Module '"@nestjs/core"' has no exported member 'NestDependencyError'.
test/app.module.spec.ts(4,15): error TS2724: '"@nestjs/common"' has no exported member named 'NestApplication'. Did you mean 'INestApplication'?
test/app.module.spec.ts(15,52): error TS2769: No overload matches this call.
  Overload 1 of 2, '(module: any, options?: NestApplicationOptions | undefined): Promise<INestApplication<any>>', gave the following error.
    Object literal may only specify known properties, and 'port' does not exist in type 'NestApplicationOptions'.
  Overload 2 of 2, '(module: any, httpAdapter: AbstractHttpAdapter<any, any, any>, options?: NestApplicationOptions | undefined): Promise<INestApplication<any>>', gave the following error.
    Object literal may only specify known properties, and 'logger' does not exist in type 'AbstractHttpAdapter<any, any, any>'.
test/app.module.spec.ts(49,52): error TS2769: No overload matches this call.
  Overload 1 of 2, '(module: any, options?: NestApplicationOptions | undefined): Promise<INestApplication<any>>', gave the following error.
    Object literal may only specify known properties, and 'port' does not exist in type 'NestApplicationOptions'.
  Overload 2 of 2, '(module: any, httpAdapter: AbstractHttpAdapter<any, any, any>, options?: NestApplicationOptions | undefined): Promise<INestApplication<any>>', gave the following error.
    Object literal may only specify known properties, and 'logger' does not exist in type 'AbstractHttpAdapter<any, any, any>'.


$ tsc --noEmit (attempt 1) -> 0


$ vitest run -> 1
      "isStopped": false,
+                         "observers": Array [],
+                         "thrownError": null,
+                       },
+                       "isListening": false,
+                     },
+                   },
+                   "moduleCompiler": ModuleCompiler {
+                     "moduleTokenFactory": ModuleTokenFactory {
+                       "logger": Logger {
+                         "context": "ModuleTokenFactory",
+                         "options": Object {
+                           "timestamp": true,
+                         },
+                       },
+                       "moduleIdsCache": WeakMap {},
+                       "moduleTokenCache": Map {
+                         "7107a5f388e760b9d3a6e_ExportProbeModule" => "71b22d69f9be9c17cfb24a7cf10c7f43291b2bb870954f619b10d1c88721d78e",
+                         "5f388e760b9d3a6e5a864_UsersModule" => "dd831b2f706c41b38ec98f309cb22848991210b56fbdadfb9c099f3d55694170",
+                       },
+                     },
+                   },
+                   "moduleTokenFactory": ModuleTokenFactory {
+                     "logger": Logger {
+                       "context": "ModuleTokenFactory",
+                       "options": Object {
+                         "timestamp": true,
+                       },
+                     },
+                     "moduleIdsCache": WeakMap {},
+                     "moduleTokenCache": Map {
+                       "7107a5f388e760b9d3a6e_ExportProbeModule" => "71b22d69f9be9c17cfb24a7cf10c7f43291b2bb870954f619b10d1c88721d78e",
+                       "5f388e760b9d3a6e5a864_UsersModule" => "dd831b2f706c41b38ec98f309cb22848991210b56fbdadfb9c099f3d55694170",
+                     },
+                   },
+                   "modules": [Circular],
+                 },
+               },
+             },
+           },
+         },
+         "responseController": RouterResponseController {
+           "applicationRef": ExpressAdapter {
+             "httpServer": Server {
+               "_connections": 0,
+               "_events": Object {
+                 "connection": [Function connectionListener],
+                 "listening": [Function setupConnectionsTracking],
+                 "request": [Function app],
+               },
+               "_eventsCount": 3,
+               "_handle": null,
+               "_listeningId": 2,
+               "_maxListeners": undefined,
+               "_unref": false,
+               "_usingWorkers": false,
+               "_workers": Array [],
+               "allowHalfOpen": true,
+               "connectionsCheckingInterval": 30000,
+               "headersTimeout": 60000,
+               "highWaterMark": 65536,
+               "httpAllowHalfOpen": false,
+               "insecureHTTPParser": undefined,
+               "joinDuplicateHeaders": undefined,
+               "keepAlive": false,
+               "keepAliveInitialDelay": 0,
+               "keepAliveTimeout": 5000,
+               "keepAliveTimeoutBuffer": 1000,
+               "maxHeaderSize": undefined,
+               "maxHeadersCount": null,
+               "maxRequestsPerSocket": 0,
+               "noDelay": true,
+               "pauseOnConnect": false,
+               "rejectNonStandardBodyWrites": false,
+               "requestTimeout": 300000,
+               "requireHostHeader": true,
+               "shouldUpgradeCallback": [Function anonymous],
+               "timeout": 0,
+               Symbol(IncomingMessage): [Function IncomingMessage],
+               Symbol(ServerResponse): [Function ServerResponse],
+               Symbol(OptimizeEmptyRequestsOption): false,
+               Symbol(shapeMode): false,
+               Symbol(kCapture): false,
+               Symbol(async_id_symbol): -1,
+               Symbol(kUniqueHeaders): null,
+             },
+             "instance": [Function app],
+             "logger": Logger {
+               "context": "ExpressAdapter",
+               "options": Object {},
+             },
+             "openConnections": Set {},
+             "routerMethodFactory": RouterMethodFactory {},
+           },
+           "logger": Logger {
+             "context": "RouterResponseController",
+             "options": Object {},
+           },
+         },
+       },
+       "graphInspector": noop {},
+       "injector": Injector {
+         "logger": Logger {
+           "context": "InjectorLogger",
+           "options": Object {},
+         },
+         "options": Object {
+           "preview": undefined,
+         },
+       },
+       "logger": Logger {
+         "context": "RouterExplorer",
+         "options": Object {
+           "timestamp": true,
+         },
+       },
+       "pathsExplorer": PathsExplorer {
+         "metadataScanner": MetadataScanner {
+           "cachedScannedPrototypes": Map {},
+         },
+       },
+       "routePathFactory": RoutePathFactory {
+         "applicationConfig": ApplicationConfig {
+           "globalFilters": Array [],
+           "globalGuards": Array [],
+           "globalInterceptors": Array [],
+           "globalPipes": Array [],
+           "globalPrefix": "",
+           "globalPrefixOptions": Object {},
+           "globalRequestFilters": Array [],
+           "globalRequestGuards": Array [],
+           "globalRequestInterceptors": Array [],
+           "globalRequestPipes": Array [],
+           "ioAdapter": null,
+         },
+       },
+       "routerMethodFactory": RouterMethodFactory {},
+       "routerProxy": RouterProxy {},
+     },
+     "routerProxy": RouterProxy {},
+   },
+   "scope": Array [],
+   "shouldFlushLogsOnOverride": false,
+   "socketModule": undefined,
+ }

 ❯ test/app.module.spec.ts:41:30
     39|     });
     40|     try {
     41|       await expect(app.init()).rejects.toThrow();
       |                              ^
     42|     } finally {
     43|       await app.close();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


