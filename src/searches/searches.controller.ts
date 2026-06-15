import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CreateSearchDto } from './dto/create-search.dto';
import { SearchesService } from './searches.service';

@Controller('searches')
export class SearchesController {
  constructor(private readonly searches: SearchesService) {}

  @Post()
  create(@Body() dto: CreateSearchDto) {
    return this.searches.create(dto);
  }

  @Get()
  findAll() {
    return this.searches.findAll();
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.searches.remove(id);
  }
}
