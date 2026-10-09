import dotenv from 'dotenv';
import { assertProductionConfig } from '../utils/productionConfig';

dotenv.config();
assertProductionConfig();
