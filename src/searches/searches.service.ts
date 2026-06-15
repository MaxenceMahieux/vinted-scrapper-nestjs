import { Injectable } from '@nestjs/common';
import { SavedSearch } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSearchDto } from './dto/create-search.dto';

@Injectable()
export class SearchesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSearchDto): Promise<SavedSearch> {
    return this.prisma.savedSearch.create({ data: dto });
  }

  findAll(): Promise<SavedSearch[]> {
    return this.prisma.savedSearch.findMany({ orderBy: { createdAt: 'desc' } });
  }

  findEnabled(): Promise<SavedSearch[]> {
    return this.prisma.savedSearch.findMany({ where: { enabled: true } });
  }

  remove(id: string): Promise<SavedSearch> {
    return this.prisma.savedSearch.delete({ where: { id } });
  }

  markRun(id: string): Promise<SavedSearch> {
    return this.prisma.savedSearch.update({
      where: { id },
      data: { lastRunAt: new Date() },
    });
  }
}
