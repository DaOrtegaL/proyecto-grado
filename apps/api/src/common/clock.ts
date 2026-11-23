import { Injectable } from '@nestjs/common';
import { loadEnv } from '../config/env';

/** Reloj inyectable: permite fijar la hora (FIXED_NOW) para escenarios y pruebas reproducibles. */
@Injectable()
export class Clock {
  now(): Date {
    const fixed = loadEnv().FIXED_NOW;
    return fixed ? new Date(fixed) : new Date();
  }
}
