import { IsString, IsInt, IsNotEmpty } from 'class-validator';

export class AnchorDocumentDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsInt()
  version!: number;
}
