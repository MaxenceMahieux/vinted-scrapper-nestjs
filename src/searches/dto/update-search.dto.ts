import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Partial of {@link CreateSearchDto}: every field is optional so a search can be
 * updated incrementally via PATCH. Implemented manually because
 * `@nestjs/mapped-types` is not a project dependency.
 */
export class UpdateSearchDto {
  @IsOptional()
  @IsString()
  name?: string;

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
