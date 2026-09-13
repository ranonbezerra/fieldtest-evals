import { Controller, Post, Param, Body, Get, Query } from '@nestjs/common';
import { MethodologyService } from './methodology.service.js';
import { MethodologyRepository } from './methodology.repository.js';

@Controller('methodology')
export class MethodologyController {
  constructor(
    private readonly service: MethodologyService,
    private readonly repository: MethodologyRepository,
  ) {}

  @Post()
  async createVersion(@Body('version') version: string): Promise<void> {
    await this.service.createVersion(version);
  }

  @Post(':versionId/rules')
  async addRule(
    @Param('versionId') versionId: string,
    @Body() rule: { name: string; severity: string; source: string },
  ): Promise<void> {
    await this.service.addRule(versionId, rule);
  }

  @Post(':versionId/publish')
  async publish(@Param('versionId') versionId: string): Promise<void> {
    await this.service.publishVersion(versionId);
  }

  @Get()
  async getPublished() {
    return this.repository.getPublished();
  }

  @Get(':versionId')
  async getById(@Param('versionId') versionId: string) {
    return this.repository.getById(versionId);
  }
}
