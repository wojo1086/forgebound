import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return welcome info', () => {
      const result = appController.getWelcome();
      expect(result.name).toBe('Forgebound API');
      expect(result.endpoints).toBeDefined();
    });
  });
});
