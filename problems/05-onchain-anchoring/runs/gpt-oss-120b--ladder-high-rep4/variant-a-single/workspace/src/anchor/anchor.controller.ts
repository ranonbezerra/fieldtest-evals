import { Controller, Post, Body } from '@nestjs/common';
import { AnchorService } from './anchor.service';
import { AnchorDocumentDto } from './dto/anchor-document.dto';
import { VerifyDto } from './dto/verify.dto';
import { AnchorState } from '@prisma/client';
