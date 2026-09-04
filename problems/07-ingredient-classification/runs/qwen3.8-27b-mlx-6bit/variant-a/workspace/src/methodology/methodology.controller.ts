import { Body, Controller, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { MethodologyService } from './methodology.service';

@Controller('methodologies')
export class MethodologyController {
  constructor(private readonly methodologyService: MethodologyService) {}

  @Post()
  create(@Body() body: { version: number; name: string }) {
    return this.methodologyService.create(body);
  }

  @Post(':id/publish')
  @HttpCode(204)
  async publish(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.methodologyService.publish(id);
  }
}
