import { Injectable } from '@nestjs/common';
import { Prisma, SavedSearch } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSearchDto } from './dto/create-search.dto';
import { UpdateSearchDto } from './dto/update-search.dto';

@Injectable()
export class SearchesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateSearchDto): Promise<SavedSearch> {
    const { facets, ...rest } = dto;
    return this.prisma.savedSearch.create({
      data: { ...rest, ...this.facetsData(facets) },
    });
  }

  findAll(): Promise<SavedSearch[]> {
    return this.prisma.savedSearch.findMany({ orderBy: { createdAt: 'desc' } });
  }

  findEnabled(): Promise<SavedSearch[]> {
    return this.prisma.savedSearch.findMany({ where: { enabled: true } });
  }

  update(id: string, dto: UpdateSearchDto): Promise<SavedSearch> {
    const { facets, ...rest } = dto;
    return this.prisma.savedSearch.update({
      where: { id },
      data: { ...rest, ...this.facetsData(facets) },
    });
  }

  /**
   * Normalise le champ `facets` (Json Prisma) : omis si absent (pas de
   * modification), sinon enregistré tel quel.
   */
  private facetsData(facets: Record<string, number[]> | undefined): {
    facets?: Prisma.InputJsonValue;
  } {
    return facets === undefined ? {} : { facets };
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
