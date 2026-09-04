import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ProfileService } from './profile.service.js';

@Controller('profiles')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get(':id')
  async findById(@Param('id', ParseIntPipe) id: number) {
    return this.profileService.findById(id);
  }
}
