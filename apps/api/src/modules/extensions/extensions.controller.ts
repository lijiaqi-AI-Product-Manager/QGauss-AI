import { Body, Controller, Get, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExtensionsService } from './extensions.service';
import { ExtensionMutationDto, PrepareExtensionRequestDto, SaveExtensionDto } from './extensions.dto';
@Controller('extensions')
export class ExtensionsController {
    constructor(private readonly extensions: ExtensionsService) { }
    @Get()
    @Header('Cache-Control', 'private, no-store')
    list(
    @CurrentUser()
    user: AuthUser) { return this.extensions.list(user.id); }
    @Roles('ADMIN')
    @Get('admin')
    @Header('Cache-Control', 'private, no-store')
    admin(
    @CurrentUser()
    user: AuthUser) { return this.extensions.admin(user.id); }
    @Roles('ADMIN')
    @Put('admin/:id')
    @Header('Cache-Control', 'private, no-store')
    save(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    dto: SaveExtensionDto) { return this.extensions.mutate(user.id, id, dto, 'save'); }
    @Roles('ADMIN')
    @Post('admin/:id/archive')
    @Header('Cache-Control', 'private, no-store')
    archive(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    dto: ExtensionMutationDto) { return this.extensions.mutate(user.id, id, dto, 'archive'); }
    @Roles('ADMIN')
    @Post('admin/:id/restore')
    @Header('Cache-Control', 'private, no-store')
    restore(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    dto: ExtensionMutationDto) { return this.extensions.mutate(user.id, id, dto, 'restore'); }
    @Get('requests/:key')
    @Header('Cache-Control', 'private, no-store')
    receipt(
    @CurrentUser()
    user: AuthUser,
    @Param('key')
    key: string) { return this.extensions.receipt(user.id, key); }
    @Post('requests/:key/end')
    @HttpCode(200)
    @Header('Cache-Control', 'private, no-store')
    end(
    @CurrentUser()
    user: AuthUser,
    @Param('key')
    key: string) { return this.extensions.end(user.id, key); }
    @Get(':id')
    @Header('Cache-Control', 'private, no-store')
    get(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.extensions.get(user.id, id); }
    @Get(':id/quote')
    @Header('Cache-Control', 'private, no-store')
    quote(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string) { return this.extensions.quote(user.id, id); }
    @Post(':id/requests')
    @Header('Cache-Control', 'private, no-store')
    prepare(
    @CurrentUser()
    user: AuthUser,
    @Param('id')
    id: string,
    @Body()
    dto: PrepareExtensionRequestDto) { return this.extensions.prepare(user.id, id, dto); }
}
