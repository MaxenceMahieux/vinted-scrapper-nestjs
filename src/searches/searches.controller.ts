import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { VintedDiscoveryService } from '../vinted/vinted.discovery';
import { CreateSearchDto } from './dto/create-search.dto';
import { UpdateSearchDto } from './dto/update-search.dto';
import { SearchesService } from './searches.service';

@Controller('searches')
export class SearchesController {
  constructor(
    private readonly searches: SearchesService,
    private readonly discovery: VintedDiscoveryService,
  ) {}

  @Post()
  create(@Body() dto: CreateSearchDto) {
    return this.searches.create(dto);
  }

  @Get()
  findAll() {
    return this.searches.findAll();
  }

  @Get('discovery/catalogs')
  getCatalogs(@Query('country') country?: string) {
    return this.discovery.getCatalogs(country);
  }

  @Get('discovery/brands')
  searchBrands(
    @Query('name') name: string,
    @Query('country') country?: string,
  ) {
    return this.discovery.searchBrands(name, country);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSearchDto) {
    return this.searches.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.searches.remove(id);
  }
}
