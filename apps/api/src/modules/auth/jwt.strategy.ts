import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: 'USER' | 'ADMIN' | 'SUPER';
  tv: number;
  sid: string;
  type: 'access';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  /**
   * 这里**故意不缓存**用户状态。
   *
   * 之前为了少打一次库做过 30 秒缓存，结果是「踢下线 / 封禁」后旧 token 还能用最多 30 秒——
   * 而"立即失效"是用户能感知的承诺，不能打折。
   * 真要缓存，必须配一套失效广播（Redis pub/sub），单实例下不值得。
   */
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException({ code: 2002, message: '凭证类型错误' });
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException({ code: 2001, message: '用户不存在' });
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ code: 2004, message: '账号已被禁用' });
    }
    // tokenVersion 不匹配 → 改密 / 封禁 / 踢下线后旧 token 立即失效
    if (payload.tv !== user.tokenVersion) {
      throw new UnauthorizedException({ code: 2002, message: '登录状态已失效，请重新登录' });
    }

    const family = typeof payload.sid === 'string' && payload.sid ? await this.prisma.refreshToken.findFirst({where:{userId:user.id,familyId:payload.sid,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true}}) : null;
    if (!family) throw new UnauthorizedException({ code: 2002, message: '此登录已退出，请重新登录' });

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };
  }
}
