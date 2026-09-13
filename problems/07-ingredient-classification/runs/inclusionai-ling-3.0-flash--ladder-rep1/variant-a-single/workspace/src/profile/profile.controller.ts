import { Controller, Post, Param, Body, Get } from "@nestjs/common";
import { ProfileService } from "./profile.service.js";

@Controller("profiles")
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Post()
  create(@Body("name") name: string) {
    return this.profileService.create(name);
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.profileService.getById(id);
  }

  @Post(":id/modifiers")
  addModifier(
    @Param("id") id: string,
    @Body("targetIngredient") targetIngredient: string,
    @Body("newSeverity") newSeverity: string,
  ) {
    return this.profileService.addModifier(id, targetIngredient, newSeverity);
  }
}
