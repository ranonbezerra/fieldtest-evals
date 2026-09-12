export class ClassificationResultDto {
  productId: number;
  methodologyVersion: number;
  profileId?: number;
  findings: any[];
  confidence: number;
  disclaimer: string;
}
