import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Lumo API (e2e integration)', () => {
  let app: INestApplication;
  let authToken: string;
  const testUser = {
    name: 'E2E Tester',
    email: `e2e_${Date.now()}@example.com`,
    password: 'password123',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // The same pipeline main.ts installs, rather than a looser copy.
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Root and Health', () => {
    it('GET / returns Hello World!', () => {
      return request(app.getHttpServer())
        .get('/')
        .expect(200)
        .expect('Hello World!');
    });
  });

  describe('Authentication Flow (/api/v1/auth)', () => {
    it('POST /api/v1/auth/signup registers a new user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send(testUser)
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.email).toBe(testUser.email);
      expect(response.body.user.fullName).toBe(testUser.name);
    });

    it('POST /api/v1/auth/login logs in successfully with valid credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: testUser.password })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      authToken = response.body.token;
      expect(typeof authToken).toBe('string');
    });

    it('POST /api/v1/auth/login rejects invalid credentials with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testUser.email, password: 'wrongpassword' })
        .expect(401);
    });
  });

  describe('Protected Endpoints (Security Enforcement)', () => {
    it('GET /api/v1/settings rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/settings')
        .expect(401);
    });

    it('GET /api/v1/hazard-reports rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/hazard-reports')
        .expect(401);
    });

    it('GET /api/v1/ai/fake-call-script rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/ai/fake-call-script')
        .expect(401);
    });
  });

  describe('Settings Flow (/api/v1/settings)', () => {
    it('GET /api/v1/settings returns user profile and security preferences', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('personalInfo');
      expect(response.body).toHaveProperty('security');
      expect(response.body).toHaveProperty('trustedContacts');
      expect(response.body.personalInfo.fullName).toBe(testUser.name);
    });

    it('PUT /api/v1/settings updates user profile and security preferences', async () => {
      const updatePayload = {
        personalInfo: {
          fullName: 'E2E Tester Updated',
          bloodType: 'O+',
          allergies: 'None',
        },
        security: {
          locationSharingEnabled: false,
          accidentDetectionEnabled: true,
          shakeToSosEnabled: true,
        },
        trustedContacts: [
          { name: 'Primary Contact', phone: '+15551234567' },
        ],
      };

      const response = await request(app.getHttpServer())
        .put('/api/v1/settings')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updatePayload)
        .expect(200);

      expect(response.body.personalInfo.fullName).toBe('E2E Tester Updated');
      expect(response.body.personalInfo.bloodType).toBe('O+');
      expect(response.body.security.locationSharingEnabled).toBe(false);
      expect(response.body.trustedContacts).toHaveLength(1);
      expect(response.body.trustedContacts[0].name).toBe('Primary Contact');
    });
  });

  describe('Hazard Reports Flow (/api/v1/hazard-reports)', () => {
    const validReport = {
      type: 'POOR_LIGHTING',
      description: 'Streetlight out on the footbridge',
      latitude: 51.5074,
      longitude: -0.1278,
      accuracyMetres: 12.5,
    };
    let createdId: string;

    it('POST /api/v1/hazard-reports stores the coordinates it was given', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/hazard-reports')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validReport)
        .expect(201);

      createdId = response.body.id;
      expect(response.body.coordinates).toEqual({
        latitude: validReport.latitude,
        longitude: validReport.longitude,
        accuracyMetres: validReport.accuracyMetres,
      });
      expect(response.body.type).toBe('POOR_LIGHTING');
      expect(response.body.source).toBe('COMMUNITY');
      expect(response.body.confirmationCount).toBe(0);
      // One person's observation does not steer anything.
      expect(response.body.influencesRouting).toBe(false);
      expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(response.body).not.toHaveProperty('severity');
      expect(response.body).not.toHaveProperty('location');
    });

    it('POST /api/v1/hazard-reports rejects a report with no position', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/hazard-reports')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ type: 'POOR_LIGHTING', description: 'Streetlight out' })
        .expect(400);
    });

    it('POST /api/v1/hazard-reports rejects a severity field', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/hazard-reports')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ...validReport, severity: 'high' })
        .expect(400);
    });

    it('POST /api/v1/hazard-reports rejects contact details in the description', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/hazard-reports')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ...validReport, description: 'ask for him on +44 7700 900123' })
        .expect(400);
    });

    it('GET /api/v1/hazard-reports lists live reports', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/hazard-reports')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('coordinates');
      expect(response.body[0]).toHaveProperty('confirmationCount');
      expect(response.body[0]).not.toHaveProperty('severity');
    });

    it('POST /api/v1/hazard-reports/:id/confirm refuses the reporter confirming their own report', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/hazard-reports/${createdId}/confirm`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(409);
    });

    it('POST /api/v1/hazard-reports/:id/confirm 404s for an unknown report', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/hazard-reports/11111111-1111-4111-8111-111111111111/confirm')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('AI Services Flow (/api/v1/ai)', () => {
    it('GET /api/v1/ai/fake-call-script returns fake call script', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/ai/fake-call-script')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('callerName');
      expect(response.body).toHaveProperty('script');
      expect(Array.isArray(response.body.script)).toBe(true);
    });

    it('GET /api/v1/ai/self-defense-tips returns self defense guidance', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/ai/self-defense-tips')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });

    it('POST /api/v1/ai/safety-chat returns safety advice response', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/ai/safety-chat')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'What should I do if walking alone at night?' })
        .expect(201);

      expect(response.body).toHaveProperty('response');
      expect(typeof response.body.response).toBe('string');
    });
  });
});
