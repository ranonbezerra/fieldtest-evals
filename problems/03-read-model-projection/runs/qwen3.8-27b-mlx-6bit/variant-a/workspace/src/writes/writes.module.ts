import { Module } from '@nestjs/common';
import { ProjectionsModule } from '../projections/projections.module';
import { WritesService } from './writes.service';

@Module({
  imports: [ProjectionsModule],
  providers: [WritesService],
})
export class WritesModule {}
