import { IsString, IsInt, IsNotEmpty } from 'class-validator';

export class VerifyDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsInt()
  version!: number;

  @IsString()
  @IsNotEmpty()
  content!: string;
}
