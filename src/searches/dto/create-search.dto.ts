import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateSearchDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  searchText?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  catalogIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  brandIds?: number[];

  @IsOptional()
  @IsNumber()
  priceFrom?: number;

  @IsOptional()
  @IsNumber()
  priceTo?: number;

  @IsOptional()
  @IsString()
  order?: string;
}
