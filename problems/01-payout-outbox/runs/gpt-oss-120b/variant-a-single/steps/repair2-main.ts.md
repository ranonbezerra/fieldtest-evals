# repair2-main.ts

## reasoning

```
We need to rewrite src/main.ts to compile. Likely need to import NestFactory, AppModule etc. Provide basic bootstrap. Ensure imports exist. There's no mention of AppModule path; likely src/app.module.ts exists. We'll just import { NestFactory } from '@nestjs/core'; import { AppModule } from './app.module'; async function bootstrap(){ const app = await NestFactory.create(AppModule); await app.listen(3000); } bootstrap();

Add necessary imports. Ensure TypeScript strict compile. That's all.
```

## reply

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Global validation pipe to enforce DTO validation
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(3000);
}
bootstrap();
```
