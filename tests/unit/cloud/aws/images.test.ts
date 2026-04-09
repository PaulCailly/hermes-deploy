import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { EC2Client, DescribeImagesCommand } from '@aws-sdk/client-ec2';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveNixosAmi } from '../../../../src/cloud/aws/images.js';

describe('resolveNixosAmi', () => {
  const ec2Mock = mockClient(EC2Client);
  let cacheFile: string;

  beforeEach(() => {
    ec2Mock.reset();
    cacheFile = join(mkdtempSync(join(tmpdir(), 'hermes-img-')), 'images.json');
  });

  afterEach(() => {
    if (existsSync(cacheFile)) rmSync(cacheFile);
  });

  it('queries DescribeImages and returns the newest image id', async () => {
    ec2Mock.on(DescribeImagesCommand).resolves({
      Images: [
        { ImageId: 'ami-old', CreationDate: '2024-01-01T00:00:00Z', Name: 'nixos/24.05.x' },
        { ImageId: 'ami-new', CreationDate: '2024-06-01T00:00:00Z', Name: 'nixos/24.05.y' },
      ],
    });
    const ec2 = new EC2Client({ region: 'eu-west-3' });
    const ref = await resolveNixosAmi(ec2, 'eu-west-3', cacheFile);
    expect(ref.id).toBe('ami-new');
  });

  it('returns the cached value on a second call within TTL', async () => {
    ec2Mock.on(DescribeImagesCommand).resolves({
      Images: [{ ImageId: 'ami-cached', CreationDate: '2024-06-01T00:00:00Z', Name: 'n' }],
    });
    const ec2 = new EC2Client({ region: 'eu-west-3' });
    await resolveNixosAmi(ec2, 'eu-west-3', cacheFile);
    expect(ec2Mock.calls()).toHaveLength(1);
    await resolveNixosAmi(ec2, 'eu-west-3', cacheFile);
    expect(ec2Mock.calls()).toHaveLength(1); // not re-called
  });

  it('throws when no images are returned', async () => {
    ec2Mock.on(DescribeImagesCommand).resolves({ Images: [] });
    const ec2 = new EC2Client({ region: 'eu-west-3' });
    await expect(resolveNixosAmi(ec2, 'eu-west-3', cacheFile)).rejects.toThrow(/no NixOS AMI/);
  });
});
