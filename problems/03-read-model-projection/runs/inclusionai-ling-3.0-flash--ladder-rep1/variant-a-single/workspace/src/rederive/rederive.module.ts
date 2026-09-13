import { Module } from '@nestjs/common';
import { ProjectionModule } from '../projection/projection.module';
import { RederiveService } from './rederive.service';

@Module({
  imports: [ProjectionModule],
  providers: [RederiveService],
  exports: [RederiveService],
})
export class RederiveModule {}
