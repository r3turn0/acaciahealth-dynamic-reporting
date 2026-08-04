-- REVIEW ONLY: Do not run against the read-only reporting database.
-- Apply to a future writable application-state SQL Server database.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID('dbo.ActivityEvents', 'U') IS NULL CREATE TABLE dbo.ActivityEvents (
  EventId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), EventType VARCHAR(100) NOT NULL,
  EntityType VARCHAR(100) NOT NULL, EntityId VARCHAR(200) NOT NULL, EntityName VARCHAR(500) NOT NULL,
  ActionBy VARCHAR(200) NOT NULL, SourceSystem VARCHAR(100) NOT NULL, MetadataJson NVARCHAR(MAX) NULL,
  EventDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), CONSTRAINT CK_ActivityEvents_MetadataJson CHECK (MetadataJson IS NULL OR ISJSON(MetadataJson)=1)
);
IF OBJECT_ID('dbo.KpiCatalog', 'U') IS NULL CREATE TABLE dbo.KpiCatalog (
  KpiId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), KpiName VARCHAR(250) NOT NULL,
  BusinessCategory VARCHAR(100) NOT NULL, Description NVARCHAR(MAX) NULL, SourceDatasetId UNIQUEIDENTIFIER NULL,
  SourceReportId UNIQUEIDENTIFIER NULL, Formula NVARCHAR(MAX) NOT NULL, ThresholdJson NVARCHAR(MAX) NULL,
  IsAIRecommended BIT NOT NULL DEFAULT 0, Confidence DECIMAL(5,4) NOT NULL DEFAULT 1,
  Status VARCHAR(50) NOT NULL, LineageJson NVARCHAR(MAX) NULL, CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_KpiCatalog_ThresholdJson CHECK (ThresholdJson IS NULL OR ISJSON(ThresholdJson)=1)
);
IF OBJECT_ID('dbo.IntelligenceAlerts', 'U') IS NULL CREATE TABLE dbo.IntelligenceAlerts (
  AlertId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), Title VARCHAR(500) NOT NULL,
  Description NVARCHAR(MAX) NOT NULL, Severity VARCHAR(20) NOT NULL, Category VARCHAR(50) NOT NULL,
  Status VARCHAR(20) NOT NULL DEFAULT 'open', EntityType VARCHAR(100) NOT NULL, EntityId VARCHAR(200) NOT NULL,
  EntityName VARCHAR(500) NOT NULL, SourceSystem VARCHAR(100) NOT NULL, CorrelationKey VARCHAR(300) NULL,
  ImpactedAssetsJson NVARCHAR(MAX) NULL, ResolutionActionsJson NVARCHAR(MAX) NULL, MetadataJson NVARCHAR(MAX) NULL,
  CreatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), UpdatedDate DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(), ResolvedDate DATETIME2 NULL
);
IF OBJECT_ID('dbo.AgentMetrics', 'U') IS NULL CREATE TABLE dbo.AgentMetrics (
  MetricId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(), AgentId VARCHAR(200) NOT NULL,
  ExecutionCount INT NOT NULL DEFAULT 0, RuntimeMs INT NOT NULL DEFAULT 0, SuccessRate DECIMAL(5,2) NOT NULL,
  RetryRate DECIMAL(5,2) NOT NULL, FailureRate DECIMAL(5,2) NOT NULL, AverageResponseMs INT NOT NULL,
  Cost DECIMAL(18,4) NOT NULL DEFAULT 0, Status VARCHAR(30) NOT NULL, LastActivity DATETIME2 NOT NULL
);
CREATE INDEX IX_ActivityEvents_EventDate ON dbo.ActivityEvents(EventDate DESC);
CREATE INDEX IX_IntelligenceAlerts_StatusSeverity ON dbo.IntelligenceAlerts(Status, Severity, CreatedDate DESC);
CREATE INDEX IX_KpiCatalog_StatusCategory ON dbo.KpiCatalog(Status, BusinessCategory);
COMMIT TRANSACTION;
