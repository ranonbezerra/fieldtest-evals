import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { MethodologyService } from './methodology.service.js';

// ASSUMPTION: MethodologyService exposes create(version: number, name: string) in addition to publish(versionId: number), matching the repository's create(data) signature.

@Controller('methodologies')
export class MethodologyController {
  constructor(private readonly methodologyService: MethodologyService) {}

  @Post()
  create(@Body() body: { version: number; name: string }) {
    return this.methodologyService.create(body.version, body.name);
  }

  @Post(':id/publish')
  @HttpCode(204)
  async publish(@Param('id') id: string): Promise<void> {
    await this.methodologyService.publish(Number(id));
  }
}
