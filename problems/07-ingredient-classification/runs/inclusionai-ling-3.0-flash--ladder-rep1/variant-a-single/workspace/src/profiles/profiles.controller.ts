import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ProfilesService } from './profiles.service.js';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly service: ProfilesService) {}

  @Post()
  async create(@Body('name') name: string) {
    return this.service.create(name);
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Post(':id/modifiers')
  async addModifier(
    @Param('id') profileId: string,
    @Body('field') field: string,
    @Body('severity') severity: string,
    @Body('description') description: string,
  ) {
    return this.service.addModifier(profileId, field, severity, description);
  }
}
