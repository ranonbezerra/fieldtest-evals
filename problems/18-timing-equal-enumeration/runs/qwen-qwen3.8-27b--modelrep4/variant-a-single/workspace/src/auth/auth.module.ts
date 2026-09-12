import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';

// Runtime dependencies assumed present in the host package.json: `argon2`
// (password hashing) and `@nestjs/jwt` (session tokens).
@Module({
  imports: [
    PrismaModule,
    MailModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        return { secret, signOptions: { expiresIn: 900 } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
})
export class AuthModule {}
