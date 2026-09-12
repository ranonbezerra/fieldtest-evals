import { ApiProperty } from '@nestjs/swagger';
import { Severity } from '@prisma/client';

export class FindingDto {
  @ApiProperty({ description: 'Original ingredient string as provided' })
  original: string;

  @ApiProperty({ description: 'Canonical ingredient name, if resolved', nullable: true })
  canonical?: string | null;

  @ApiProperty({ description: 'Whether this ingredient triggered a rule' })
  flag: boolean;

  @ApiProperty({ description: 'Severity level if flagged', enum: Severity, nullable: true })
  severity?: Severity | null;

  @ApiProperty({ description: 'Source citation for the rule', nullable: true })
  sourceCitation?: string | null;

  @ApiProperty({ description: 'True if the ingredient could not be resolved' })
  unknown: boolean;
}

export class ClassificationResultDto {
  @ApiProperty({ description: 'Product ID' })
  productId: number;

  @ApiProperty({ description: 'Methodology version used for classification' })
  methodologyVersion: string;

  @ApiProperty({ description: 'Overall confidence (0-1)' })
  confidence: number;

  @ApiProperty({ description: 'Disclaimer text' })
  disclaimer: string;

  @ApiProperty({ type: [FindingDto], description: 'Per-ingredient findings' })
  findings: FindingDto[];
}
