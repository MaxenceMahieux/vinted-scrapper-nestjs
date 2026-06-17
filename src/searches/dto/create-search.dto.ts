import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
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
  @IsArray()
  @IsInt({ each: true })
  statusIds?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  sizeIds?: number[];

  @IsOptional()
  @IsNumber()
  priceFrom?: number;

  @IsOptional()
  @IsNumber()
  priceTo?: number;

  @IsOptional()
  @IsString()
  order?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  includeKeywords?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeKeywords?: string[];

  /** Facettes Vinted génériques : { "<param>_ids": [ids] } (material_ids, …). */
  @IsOptional()
  @IsObject()
  facets?: Record<string, number[]>;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  channels?: string[];

  @IsOptional()
  @IsBoolean()
  dealOnly?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minDealScore?: number;
}
