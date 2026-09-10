import { Module } from '@nestjs/common';
import { DOCUMENT_CONTENT, InMemoryDocumentContentProvider } from './document-content-provider.js';

@Module({
  providers: [
    // In-memory stand-in for the report store; a production implementation
    // of DocumentContentProvider replaces this factory.
    { provide: DOCUMENT_CONTENT, useFactory: () => new InMemoryDocumentContentProvider() },
  ],
  exports: [DOCUMENT_CONTENT],
})
export class ContentModule {}
