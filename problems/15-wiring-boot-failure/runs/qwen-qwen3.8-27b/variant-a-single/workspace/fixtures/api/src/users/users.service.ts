import { Inject, Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';
import type { UserRecord } from './users.repository.js';
import { ExportService } from '../exports/exports.service.js';
import type { UserExportRow } from '../exports/exports.service.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(UsersRepository) private readonly usersRepository: UsersRepository,
    @Inject(ExportService) private readonly exportService: ExportService,
  ) {}

  findAll(): Promise<UserRecord[]> {
    return this.usersRepository.findAll();
  }

  exportAll(): Promise<UserExportRow[]> {
    return this.exportService.exportUsers();
  }
}
