-- REVIEW ONLY: apply through the approved database migration process.
CREATE TABLE DatasetValidations (
  ValidationId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  DatasetId UNIQUEIDENTIFIER NOT NULL,
  ValidationProfileId UNIQUEIDENTIFIER NOT NULL,
  LineageId UNIQUEIDENTIFIER NOT NULL,
  ValidationType VARCHAR(100) NOT NULL,
  Status VARCHAR(50) NOT NULL,
  Score DECIMAL(5,2) NOT NULL,
  ResultsJson NVARCHAR(MAX) NOT NULL,
  CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_DatasetValidations_Datasets FOREIGN KEY (DatasetId) REFERENCES Datasets(DatasetId)
);
CREATE INDEX IX_DatasetValidations_DatasetId_CreatedDate ON DatasetValidations(DatasetId, CreatedDate DESC);
