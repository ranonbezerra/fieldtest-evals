import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { RefreshModule } from '../src/auth/refresh/refresh.module.js';
import { RefreshService } from '../src/auth/refresh/refresh.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { generateRandomToken, hashToken } from '../src/auth/refresh/refresh.utils.js';
import * as request from 'supertest';
import cookieParser from 'cookie-parser';
import { RefreshError } from '../src/auth/refresh/refresh.error.js';
