import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { GuideModule } from '../guide/guide.module.js';
import { EvalService } from './eval.service.js';

@Module({
  imports: [GuideModule],
  providers: [EvalService],
  exports: [EvalService],
})
export class EvalModule {}
