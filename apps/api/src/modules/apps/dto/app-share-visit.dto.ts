import {IsUUID} from 'class-validator';

export class AppShareVisitDto {
  @IsUUID('4') requestKey:string;
}
