import { Inject, Injectable } from '@nestjs/common';
import { ExportsRepository } from './exports.repository.js';
import type { UserExportRow } from './exports.repository.js';

export type { UserExportRow } from './exports.repository.js';

@Injectable()
export class ExportService {
  constructor(@Inject(ExportsRepository) private readonly exportsRepository: ExportsRepository) {}

  exportUsers(): Promise<UserExportRow[]> {
    return this.exportsRepository.findUsersForExport();
  }
}
