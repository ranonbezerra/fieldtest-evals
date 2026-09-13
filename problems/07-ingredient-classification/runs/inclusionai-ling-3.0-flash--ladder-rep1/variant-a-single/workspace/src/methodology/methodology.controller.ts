import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { MethodologyService } from "./methodology.service.js";

@Controller("methodology")
export class MethodologyController {
  constructor(private readonly methodologyService: MethodologyService) {}

  @Post("versions")
  createVersion(@Body("version") version: string) {
    return this.methodologyService.createVersion(version);
  }

  @Get("versions/:id")
  getVersion(@Param("id") id: string) {
    return this.methodologyService.getVersion(id);
  }

  @Get("versions")
  getActive() {
    return this.methodologyService.getActive();
  }

  @Post("versions/:id/rules")
  addRule(
    @Param("id") id: string,
    @Body("name") name: string,
    @Body("ingredientName") ingredientName: string,
    @Body("severity") severity: string,
    @Body("sourceCitation") sourceCitation: string,
    @Body("source") source: string,
  ) {
    return this.methodologyService.addRule(id, {
      name,
      ingredientName,
      severity,
      sourceCitation,
      source,
    });
  }

  @Post("versions/:id/publish")
  async publish(@Param("id") id: string) {
    await this.methodologyService.publishVersion(id);
    return { success: true };
  }
}
