import { Module } from "@nestjs/common";
import { ProfileService } from "./profile.service.js";
import { ProfileRepository } from "./profile.repository.js";
import { ProfileController } from "./profile.controller.js";

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, ProfileRepository],
  exports: [ProfileService, ProfileRepository],
})
export class ProfileModule {}
