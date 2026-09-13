import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import { IChainClient } from './chain-client.interface';
import { AnchorState } from '@prisma/client';
import { Cron } from '@nestjs/schedule';
