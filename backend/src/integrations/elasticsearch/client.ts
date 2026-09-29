import { Client } from '@elastic/elasticsearch';
import { config } from '../../config/env.js';

export const elasticsearchClient = new Client({ node: config.elasticsearchUrl });
export const EMAIL_JOBS_INDEX = 'email-jobs';
